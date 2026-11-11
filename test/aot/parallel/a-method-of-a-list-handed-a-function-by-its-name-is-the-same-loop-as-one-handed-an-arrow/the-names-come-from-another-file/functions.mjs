export function twice(row) { return row.qty * 2; }
export function big(value) { return value > 2; }
export function add(total, value) { return total + value; }
export let chosen = big;
export function choose(other) { chosen = other; }
export default function half(row) { return row.qty / 2; }
