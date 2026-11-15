import { Marks } from "./marks.js";
import * as all from "./marks.js";
export function store() { Marks.Tab = 10; }
export function assign() { Object.assign(Marks, { Space: 33, More: 1 }); }
export function throughNamespace(change) { change(all); }
