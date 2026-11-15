// The build stopped in BuildImage: the object of bun:jsc was let go behind the flow, which had run as if nothing were open.
import { heapSize } from "bun:jsc";
console.log(typeof heapSize());
