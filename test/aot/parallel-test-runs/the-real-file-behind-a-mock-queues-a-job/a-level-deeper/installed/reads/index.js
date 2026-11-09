import "first";
import { seen as inner } from "./inner.js";
import "last";
export const seen = inner;
