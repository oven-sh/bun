export default function f() { return "first"; }
export function bumpF() { f = () => "second"; }
