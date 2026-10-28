// a-fast-path-is-left-behind-the-read-of-the-method.ts where every call stays a call and all code counts as hot: what a caller believes about a callee is only tested there, and only hot code keeps a closure that may leave in the frame. The output is that of plain Bun.
import "./a-fast-path-is-left-behind-the-read-of-the-method.ts";
