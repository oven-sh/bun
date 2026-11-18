use super::{shell, window};
use crate::bridge;
use crate::error::Result;
use crate::protocol::{FilePicker, MessageBox, Reply};
use crate::sync::Mutex;
use crate::win32::com::{self, Outcome, Status, filled, made};
use crate::win32::*;

fn path_of(item: &IShellItem) -> Outcome<String> {
    Ok(made(|it| item.get_display_name(SIGDN_FILESYSPATH, it))?.text())
}

fn pick(options: &FilePicker, owner: Handle) -> Outcome<Vec<String>> {
    let dialog: IFileDialog = com::create(if options.saves {
        CLSID_FILE_SAVE_DIALOG
    } else {
        CLSID_FILE_OPEN_DIALOG
    })?;
    let flags = [
        (FOS_PICKFOLDERS, options.takes_directories),
        (FOS_ALLOWMULTISELECT, options.takes_many),
        (FOS_FORCESHOWHIDDEN, options.shows_hidden_files),
        (FOS_NODEREFERENCELINKS, options.keeps_aliases),
    ];
    let usual = filled(|it| dialog.get_options(it))? | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR;
    dialog
        .set_options(
            flags
                .iter()
                .filter(|it| it.1)
                .fold(usual, |all, it| all | it.0),
        )
        .ok()?;
    let pattern = |extension: &str| {
        if extension == "*" {
            "*.*".to_owned()
        } else {
            format!("*.{extension}")
        }
    };
    let patterns = |it: &crate::protocol::FileFilter| {
        it.extensions
            .iter()
            .map(|it| pattern(it))
            .collect::<Vec<_>>()
            .join(";")
    };
    let texts: Vec<_> = options
        .filters
        .iter()
        .filter(|_| !options.takes_directories)
        .map(|it| (Wide::new(&*it.name), Wide::new(patterns(it))))
        .collect();
    let filters: Vec<_> = texts
        .iter()
        .map(|it| ComDlgFilterSpec {
            psz_name: it.0.str(),
            psz_spec: it.1.str(),
        })
        .collect();
    if !filters.is_empty() {
        // SAFETY: the vector with its length.
        dialog
            .set_file_types(filters.len() as u32, unsafe { Raw::new(filters.as_ptr()) })
            .ok()?;
    }
    let extension = options
        .filters
        .iter()
        .flat_map(|it| it.extensions.iter())
        .next()
        .filter(|it| &***it != "*");
    extension.inspect(|it| _ = dialog.set_default_extension(Wide::new(&***it).str()));
    options
        .title
        .unless_empty()
        .inspect(|it| _ = dialog.set_title(Wide::new(it).str()));
    options
        .button_label
        .unless_empty()
        .inspect(|it| _ = dialog.set_ok_button_label(Wide::new(it).str()));
    options
        .file_name
        .unless_empty()
        .inspect(|it| _ = dialog.set_file_name(Wide::new(it).str()));
    options
        .directory
        .unless_empty()
        .and_then(|it| shell::item::<IShellItem>(it).ok())
        .inspect(|it| _ = dialog.set_folder(it.borrowed()));
    match dialog.show(owner) {
        Status::CANCELLED => return Ok(Vec::new()),
        status => status.ok()?,
    }
    if options.saves {
        return Ok(vec![path_of(&made(|it| dialog.get_result(it))?)?]);
    }
    let dialog: IFileOpenDialog = dialog.cast()?;
    let items = made(|it| dialog.get_results(it))?;
    (0..filled(|it| items.get_count(it))?)
        .map(|index| path_of(&made(|it| items.get_item_at(index, it))?))
        .collect()
}

pub fn pick_files(id: u32, options: FilePicker) -> Result<()> {
    let owner = window::handle_of(options.window.get());
    shell::in_apartment("files", move || {
        bridge::reply(
            id,
            pick(&options, owner)
                .map(|it| Reply::Paths(it.into_iter().map(Into::into).collect()))
                .map_err(Into::into),
        )
    })
}

/// With their windows, which are 0 until they exist.
static OPEN_BOXES: Mutex<Vec<(u32, Handle)>> = Mutex::new(Vec::new());

unsafe extern "system" fn note_window(
    dialog: Handle,
    event: u32,
    _: usize,
    _: isize,
    id: isize,
) -> i32 {
    if event == TDN_CREATED {
        match OPEN_BOXES.lock().iter_mut().find(|it| it.0 == id as u32) {
            Some(open) => open.1 = dialog,
            None => _ = PostMessageW(dialog, TDM_CLICK_BUTTON, IDCANCEL as usize, 0),
        }
    }
    0
}

pub fn close_message_box(id: u32) {
    OPEN_BOXES
        .lock()
        .extract_if(.., |it| {
            it.0 == id
                && (it.1 == 0 || PostMessageW(it.1, TDM_CLICK_BUTTON, IDCANCEL as usize, 0) != 0)
        })
        .for_each(drop);
}

/// The executable may not have asked for the version of the controls that has the dialog. The shell has.
fn use_current_controls() {
    const MANIFEST: u16 = 124;
    let mut folder = [0; 260];
    // SAFETY: the buffer with its length.
    unsafe { GetSystemDirectoryW(folder.as_mut_ptr(), folder.len() as u32) };
    let folder = Wide::new(string_in(&folder));
    let context = ActCtxW {
        cb_size: size_of::<ActCtxW>() as u32,
        dw_flags: ACTCTX_FLAG_RESOURCE_NAME_VALID | ACTCTX_FLAG_ASSEMBLY_DIRECTORY_VALID,
        lp_source: wide!("shell32.dll"),
        lp_assembly_directory: folder.str(),
        lp_resource_name: Str::numbered(MANIFEST),
        ..Default::default()
    };
    ActivateActCtx(CreateActCtxW(&context), &mut 0);
}

fn ask(question: &MessageBox, title: &str, owner: Handle) -> Outcome<Reply> {
    const FIRST: i32 = 100;
    let [title, message, detail, checkbox] = [
        title,
        &question.message,
        &question.detail,
        &question.checkbox_label,
    ]
    .map(Wide::new);
    let labels: Vec<_> = question.buttons.iter().map(|it| Wide::new(&**it)).collect();
    let buttons: Vec<_> = (FIRST..)
        .zip(&labels)
        .map(|(id, label)| TaskDialogButton {
            n_button_id: id,
            psz_button_text: label.str(),
        })
        .collect();
    let has_detail = !question.detail.is_empty();
    let dialog = TaskDialogConfig {
        cb_size: size_of::<TaskDialogConfig>() as u32,
        hwnd_parent: owner,
        dw_flags: TDF_ALLOW_DIALOG_CANCELLATION
            | TDF_POSITION_RELATIVE_TO_WINDOW
            | TDF_SIZE_TO_CONTENT
            | if question.is_checked {
                TDF_VERIFICATION_FLAG_CHECKED
            } else {
                0
            },
        psz_window_title: title.str(),
        psz_main_icon: if question.is_grave {
            Str::numbered(TD_WARNING_ICON)
        } else {
            Str::NULL
        },
        psz_main_instruction: if has_detail { message.str() } else { Str::NULL },
        psz_content: if has_detail {
            detail.str()
        } else {
            message.str()
        },
        c_buttons: buttons.len() as u32,
        p_buttons: buttons.as_ptr(),
        n_default_button: FIRST + question.default_button,
        psz_verification_text: if question.checkbox_label.is_empty() {
            Str::NULL
        } else {
            checkbox.str()
        },
        pf_callback: Some(note_window),
        lp_callback_data: question.id as isize,
        ..Default::default()
    };
    let (mut pressed, mut is_checked) = (0, 0);
    use_current_controls();
    task_dialog_indirect(&dialog, &mut pressed, None, &mut is_checked).ok()?;
    Ok(Reply::Button {
        index: u32::try_from(pressed - FIRST).ok().into(),
        is_checked: is_checked != 0,
    })
}

pub fn show_message_box(id: u32, question: MessageBox, title: String) -> Result<()> {
    let owner = window::handle_of(question.window.get());
    OPEN_BOXES.lock().push((question.id, 0));
    shell::in_apartment("message", move || {
        let answer = ask(&question, &title, owner);
        OPEN_BOXES.lock().retain(|it| it.0 != question.id);
        bridge::reply(id, answer.map_err(Into::into));
    })
}
