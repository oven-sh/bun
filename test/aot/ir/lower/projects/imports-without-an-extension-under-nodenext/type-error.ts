// RUN: link
// DIAGNOSTIC: TS2322 1

import { value } from "./imports/src/value";

export const text: string = value;
