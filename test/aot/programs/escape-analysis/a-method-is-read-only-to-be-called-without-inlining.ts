// a-method-is-read-only-to-be-called.ts where every call stays a call and all code counts as hot: what a caller believes about a callee is only tested there, and only hot code keeps a closure that may leave in the frame. The output is that of plain Bun.
import "./a-method-is-read-only-to-be-called.ts";
