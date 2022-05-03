pub export fn add(a: i32, b: i32) i32 {
    return a + b;
}

// to compile:
// zig build-lib -OReleaseFast ./add.zig -dynamic --name add
