//! The job that ends children with this process.

use core::ptr;
use std::sync::OnceLock;

use super::win32::{self, DWORD, HANDLE};

struct Job(Result<HANDLE, DWORD>);
// SAFETY: a job handle may be used from any thread.
unsafe impl Send for Job {}
// SAFETY: see above.
unsafe impl Sync for Job {}

static GLOBAL_JOB: OnceLock<Job> = OnceLock::new();

/// The process-wide job every child that is not detached is created in.
///
/// The handle is not inheritable and never closed, so this process ending, for
/// any reason, is what closes the job, and `KILL_ON_JOB_CLOSE` then ends the
/// children in it. `SILENT_BREAKAWAY_OK` keeps *their* children out of the
/// job: only processes put in explicitly are members, so children stay free to
/// use jobs themselves on systems without nested jobs and to start detached
/// processes. `DIE_ON_UNHANDLED_EXCEPTION` suppresses the crash dialog for
/// members.
///
/// Null when no child of this process can be a member.
pub fn global_job() -> Result<HANDLE, DWORD> {
    GLOBAL_JOB.get_or_init(|| Job(create())).0
}

fn create() -> Result<HANDLE, DWORD> {
    // SAFETY: null attributes (not inheritable) and no name.
    let job = unsafe { win32::CreateJobObjectW(ptr::null_mut(), ptr::null()) };
    if job.is_null() {
        return Err(win32::GetLastError());
    }
    let close = |err: DWORD| {
        // SAFETY: `job` is a handle this function owns.
        unsafe { win32::CloseHandle(job) };
        err
    };

    let mut info: win32::JOBOBJECT_EXTENDED_LIMIT_INFORMATION = bun_core::ffi::zeroed();
    info.BasicLimitInformation.LimitFlags = win32::JOB_OBJECT_LIMIT_BREAKAWAY_OK
        | win32::JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
        | win32::JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
        | win32::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: `info` is the structure `JobObjectExtendedLimitInformation` takes.
    if unsafe {
        win32::SetInformationJobObject(
            job,
            win32::JobObjectExtendedLimitInformation,
            ptr::from_mut(&mut info).cast(),
            size_of::<win32::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as DWORD,
        )
    } == 0
    {
        return Err(close(win32::GetLastError()));
    }

    // If the first process put in a job is a Windows Store program, every
    // later use of the handle fails with ERROR_INVALID_PARAMETER, seemingly
    // because a job is tied to the session of its first member. Joining it
    // ourselves first ties it to ours.
    // SAFETY: both handles are valid.
    if unsafe { win32::AssignProcessToJobObject(job, win32::GetCurrentProcess()) } == 0 {
        let err = win32::GetLastError();
        if err != win32::ERROR_ACCESS_DENIED {
            return Err(close(err));
        }
        // The jobs this process is in do not let this one nest below them. A
        // child that is born in all of them is refused the same way.
        if children_stay_in_our_jobs() {
            close(err);
            return Ok(ptr::null_mut());
        }
    }

    Ok(job)
}

/// Whether a child is born in every job this process is in. It is unless the
/// innermost of them lets children break away silently; how far up such a
/// child leaves cannot be asked, so whether it may join is only known by
/// creating it. `CREATE_BREAKAWAY_FROM_JOB` is never passed, so
/// `BREAKAWAY_OK` changes nothing.
fn children_stay_in_our_jobs() -> bool {
    let mut info: win32::JOBOBJECT_EXTENDED_LIMIT_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: a null job is the innermost job of the calling process; `info`
    // is the structure `JobObjectExtendedLimitInformation` fills.
    let queried = unsafe {
        win32::QueryInformationJobObject(
            ptr::null_mut(),
            win32::JobObjectExtendedLimitInformation,
            ptr::from_mut(&mut info).cast(),
            size_of::<win32::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as DWORD,
            ptr::null_mut(),
        )
    } != 0;
    queried
        && info.BasicLimitInformation.LimitFlags & win32::JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK == 0
}
