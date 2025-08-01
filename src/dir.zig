pub const Dir = struct {
    fd: FileDescriptor,
};

const bun = @import("bun");
const FileDescriptor = bun.FileDescriptor;
