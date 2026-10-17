// `for await` and `yield*` do not keep the last value of an async generator alive while the loop body waits for something else.
import "../../jsc-shell-functions.ts";
import "./program.ts";
