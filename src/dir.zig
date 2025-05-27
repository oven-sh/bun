const bun = @import("bun");
const FileDescriptor = bun.FileDescriptor;

pub const Dir = struct {
    fd: FileDescriptor,
};
