// callees-of-every-kind-get-a-callback-written-at-the-call.js where every call stays a call and all code counts as hot: what a caller believes about a callee is only tested there, and only hot code keeps a closure that may leave in the frame. The output is that of plain Bun.
import "./callees-of-every-kind-get-a-callback-written-at-the-call.js";
