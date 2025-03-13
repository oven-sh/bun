const bun = @import("root").bun;

const InitError = @import("./errors.zig").InitError;
const stringZ = bun.stringZ;
const Output = bun.Output;
const Global = bun.Global;

fn onInitErrorNoop(err: InitError, opts: InitOpts) noreturn {
    switch (err) {
        error.LoadCAFile => {
            if (!bun.sys.existsZ(opts.abs_ca_file_name)) {
                Output.err("HTTPThread", "failed to find CA file: '{s}'", .{opts.abs_ca_file_name});
            } else {
                Output.err("HTTPThread", "failed to load CA file: '{s}'", .{opts.abs_ca_file_name});
            }
        },
        error.InvalidCAFile => {
            Output.err("HTTPThread", "the CA file is invalid: '{s}'", .{opts.abs_ca_file_name});
        },
        error.InvalidCA => {
            Output.err("HTTPThread", "the provided CA is invalid", .{});
        },
        error.FailedToOpenSocket => {
            Output.errGeneric("failed to start HTTP client thread", .{});
        },
    }
    Global.crash();
}

pub const InitOpts = struct {
    ca: []stringZ = &.{},
    abs_ca_file_name: stringZ = &.{},
    for_install: bool = false,

    onInitError: *const fn (err: InitError, opts: InitOpts) noreturn = &onInitErrorNoop,
};
