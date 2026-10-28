import * as other from "only-imported";
import * as both from "two-files";
import { kind } from "two-files";

export const kindByName = (): string => kind;
export const kindByNamespace = (): string => both.kind;
export const kindOfOther = (): string => other.kind;
