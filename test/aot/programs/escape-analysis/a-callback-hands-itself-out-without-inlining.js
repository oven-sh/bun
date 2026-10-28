// a-callback-hands-itself-out.js where every call stays a call and all code counts as hot: what a caller believes about a callee is only tested there, and only hot code keeps a closure that may leave in the frame. The output is that of plain Bun.
import "./a-callback-hands-itself-out.js";
