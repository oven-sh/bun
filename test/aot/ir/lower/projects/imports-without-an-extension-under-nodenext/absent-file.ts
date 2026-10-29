// RUN: link
// DIAGNOSTIC: TS100150 1

import { value } from "./imports/src/absent";

export const found = value;
