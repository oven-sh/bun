let value = 1;
function some(list) { let method = list.some; for (;;) method(() => value); }
function every(list) { let method = list.every; for (;;) method(element => element > value); }
function map(list) { let method = list.map, result; for (let i = 0; i < 3; i++) result = method(element => element + 1); return result; }
function filter(list) { let { filter: method } = list, count = 0; for (let i = 0; i < 3; i++) count += method(element => element > 1).length; return count; }
function chain(list) { let method = list.filter, result; for (let i = 0; i < 3; i++) result = method(element => element > 1).map(element => element * 2); return result; }
function find(list) { let method = list.find; for (;;) method(element => element === value); }
function findLastIndex(list) { let method = list.findLastIndex; for (;;) method(element => element === value); }
function reduce(list) { let method = list.reduce, sum = 0; for (let i = 0; i < 3; i++) sum += method((a, b) => a + b, 0); return sum; }
function comma(list) { let sum = 0; for (let i = 0; i < 3; i++) sum += (0, list.reduce)((a, b) => a + b, 0); return sum; }
function sort(list) { let method = list.sort; for (let i = 0; i < 3; i++) method((a, b) => a - b); return list; }
function forEach(list) { let method = list.forEach; for (let i = 0; i < 3; i++) method(element => { value += element; }); return value; }
function flatMap(list) { let method = list.flatMap; for (let i = 0; i < 3; i++) method(element => [element]); return list; }
function kept(list) { return list.map(element => element + 1).some(element => element > value); }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("some", some(list)); } catch (error) { console.log("some", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("every", every(list)); } catch (error) { console.log("every", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("map", map(list)); } catch (error) { console.log("map", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("filter", filter(list)); } catch (error) { console.log("filter", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("chain", chain(list)); } catch (error) { console.log("chain", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("find", find(list)); } catch (error) { console.log("find", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("findLastIndex", findLastIndex(list)); } catch (error) { console.log("findLastIndex", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("reduce", reduce(list)); } catch (error) { console.log("reduce", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("comma", comma(list)); } catch (error) { console.log("comma", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("sort", sort(list)); } catch (error) { console.log("sort", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("forEach", forEach(list)); } catch (error) { console.log("forEach", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("flatMap", flatMap(list)); } catch (error) { console.log("flatMap", error instanceof TypeError); } }
for (const [made] of [[[1, 2, 3]]]) { const list = made; try { console.log("kept", kept(list)); } catch (error) { console.log("kept", error instanceof TypeError); } }
