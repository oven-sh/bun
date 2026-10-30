import type { Box } from "./shared";
interface Maker<T> { make(): Box<[[[T]]]> }
export function other(maker: Maker<number>): unknown { return maker.make().v; }
