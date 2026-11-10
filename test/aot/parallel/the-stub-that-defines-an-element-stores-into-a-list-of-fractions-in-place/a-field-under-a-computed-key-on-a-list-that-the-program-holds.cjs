'use strict';
function Hand(list) { return list; }
function told(list) { let s = list.length + ':'; for (let i = 0; i < list.length; i++) s += (i in list ? typeof list[i] + ' ' + list[i] : 'hole') + ','; return s; }
function atLength(size) { const list = []; for (let i = 0; i < size; i++) list.push(i + 0.5); const key = size; class AtLength extends Hand { [key] = 9.5; } new AtLength(list); return told(list); }
function below(size) { const list = []; for (let i = 0; i < size; i++) list.push(i + 0.5); const key = size >> 1; class Below extends Hand { [key] = 9.5; } new Below(list); return told(list); }
globalThis.kept = [atLength, below];
for (const make of globalThis.kept) for (let size = 1; size <= 20; size++) console.log(make.name, size, make(size));
