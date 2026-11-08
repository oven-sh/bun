import { count } from "./counter.js";
export function store() { count = 5; }
function neverCalled() { count++; }
