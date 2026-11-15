export function say(list) { "use memo"; return list.map(item => item + (import.meta.main ? " main" : " not main")).join(); }
