import { value } from "dep";
import "last";
(globalThis.order ??= []).push("reads");
export const seen = () => value();
