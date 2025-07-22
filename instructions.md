# Fixing symlinks (reparse point) with the shell `rm` built-in on Windows

On Posix systems for the `rm` shell built-in, if we don't know yet whether a
file is a regular file or directory, we try to `unlink` it first.

If it is actually a directory, it will return `EISDIR` and we go and delete its
children before calling `rmdirat`.

Conveniently, this handles _symlinks_ to directories too.

However, this breaks on Windows if we have a symlink to a directory. Why? We
don't have `unlink` on Windows. Instead we have a `DeleteFileBun(...)` function
inside of `src/windows.zig` that _tries_ to do the equivalent.

Unfortunately, it does not have the same behavior as posix for deleting
symlinks. It will return with `EISDIR` (despite the `FILE_OPEN_REPARSE_POINT`
being set, it seems to always try to delete the referenced directory).

So the solution is that we need to use the Windows API to delete the reparse
point. We can do it like this:

```C
HANDLE h = CreateFileW(L"linkDir",
                       GENERIC_WRITE,                        // must allow write
                       FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                       NULL,
                       OPEN_EXISTING,
                       FILE_FLAG_OPEN_REPARSE_POINT |        // don’t follow
                       FILE_FLAG_BACKUP_SEMANTICS,
                       NULL);

// header only – tag identifies which reparse point to remove
REPARSE_GUID_DATA_BUFFER hdr = {0};
hdr.ReparseTag = IO_REPARSE_TAG_SYMLINK;   // or _MOUNT_POINT, _SOCK, etc.

DWORD bytes;
DeviceIoControl(h,
                FSCTL_DELETE_REPARSE_POINT,                 // core op
                &hdr, REPARSE_GUID_DATA_BUFFER_HEADER_SIZE, // in buf / len
                NULL, 0,                                    // no out
                &bytes,
                NULL);

```

I want you to implement this code in Zig.
