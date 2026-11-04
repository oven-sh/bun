// Written by ./generate.py, formatted by prettier. A list that holds numbers and undefined is read as numbers in a loop, and its elements are asked for undefined in 129 ways, each in a function of its own.
// The loop's reads are compiled for Double storage and copied for storage that holds any value. Behind the proof of Double storage `list[i] === undefined` is false: the copy may not go on into code that says so.
let out = "";
function note(value) {
  out += String(value) + ";";
}
function nothing() {}
function sum3(a, b, c) {
  return a + b + c;
}
function orNine(x = 9) {
  return x;
}
const lists = () => [
  [-1, 7, [][0]],
  Array.from({ length: 3 }, (each, at) => (at === 1 ? nothing() : 1)),
  [1, 2, 3].map(x => x),
  [1.5, 2.5, 3.5],
  [[][0], 4, 5],
  [1, 2, 3, 4, 5, 6, 7, 8].map(x => (x % 3 ? x : nothing())),
  [nothing(), nothing(), nothing()],
];
function w_for_strict(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (list[j] === undefined) count++;
      note(count);
    }
  }
}
out += "\nfor_strict: ";
for (const list of lists()) w_for_strict(list);
function w_for_loose(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (list[j] == null) count++;
      note(count);
    }
  }
}
out += "\nfor_loose: ";
for (const list of lists()) w_for_loose(list);
function w_for_typeof(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (typeof list[j] === "undefined") count++;
      note(count);
    }
  }
}
out += "\nfor_typeof: ";
for (const list of lists()) w_for_typeof(list);
function w_for_void(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (list[j] === void 0) count++;
      note(count);
    }
  }
}
out += "\nfor_void: ";
for (const list of lists()) w_for_void(list);
function w_for_is(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (Object.is(list[j], undefined)) count++;
      note(count);
    }
  }
}
out += "\nfor_is: ";
for (const list of lists()) w_for_is(list);
function w_for_coalesce(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if ((list[j] ?? 100) === 100) count++;
      note(count);
    }
  }
}
out += "\nfor_coalesce: ";
for (const list of lists()) w_for_coalesce(list);
function w_for_notNumber(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (typeof list[j] !== "number") count++;
      note(count);
    }
  }
}
out += "\nfor_notNumber: ";
for (const list of lists()) w_for_notNumber(list);
function w_for_default(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (orNine(list[j]) === 9) count++;
      note(count);
    }
  }
}
out += "\nfor_default: ";
for (const list of lists()) w_for_default(list);
function w_for_string(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (String(list[j]) === "undefined") count++;
      note(count);
    }
  }
}
out += "\nfor_string: ";
for (const list of lists()) w_for_string(list);
function w_for_chain(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (list[j]?.toFixed === undefined) count++;
      note(count);
    }
  }
}
out += "\nfor_chain: ";
for (const list of lists()) w_for_chain(list);
function w_for_inList(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if ([list[j]].includes(undefined)) count++;
      note(count);
    }
  }
}
out += "\nfor_inList: ";
for (const list of lists()) w_for_inList(list);
function w_for_isNaN(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (isNaN(list[j])) count++;
      note(count);
    }
  }
}
out += "\nfor_isNaN: ";
for (const list of lists()) w_for_isNaN(list);
function w_for_notSelf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (list[j] !== list[j]) count++;
      note(count);
    }
  }
}
out += "\nfor_notSelf: ";
for (const list of lists()) w_for_notSelf(list);
function w_for_not(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if (!list[j]) count++;
      note(count);
    }
  }
}
out += "\nfor_not: ";
for (const list of lists()) w_for_not(list);
function w_for_or(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++) if ((list[j] || 50) === 50) count++;
      note(count);
    }
  }
}
out += "\nfor_or: ";
for (const list of lists()) w_for_or(list);
function w_for_switch(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = 0; j < list.length; j++)
        if (
          (() => {
            switch (list[j]) {
              case undefined:
                return true;
              default:
                return false;
            }
          })()
        )
          count++;
      note(count);
    }
  }
}
out += "\nfor_switch: ";
for (const list of lists()) w_for_switch(list);
function w_of_strict(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (e === undefined) count++;
      note(count);
    }
  }
}
out += "\nof_strict: ";
for (const list of lists()) w_of_strict(list);
function w_of_loose(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (e == null) count++;
      note(count);
    }
  }
}
out += "\nof_loose: ";
for (const list of lists()) w_of_loose(list);
function w_of_typeof(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (typeof e === "undefined") count++;
      note(count);
    }
  }
}
out += "\nof_typeof: ";
for (const list of lists()) w_of_typeof(list);
function w_of_void(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (e === void 0) count++;
      note(count);
    }
  }
}
out += "\nof_void: ";
for (const list of lists()) w_of_void(list);
function w_of_is(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (Object.is(e, undefined)) count++;
      note(count);
    }
  }
}
out += "\nof_is: ";
for (const list of lists()) w_of_is(list);
function w_of_coalesce(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if ((e ?? 100) === 100) count++;
      note(count);
    }
  }
}
out += "\nof_coalesce: ";
for (const list of lists()) w_of_coalesce(list);
function w_of_notNumber(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (typeof e !== "number") count++;
      note(count);
    }
  }
}
out += "\nof_notNumber: ";
for (const list of lists()) w_of_notNumber(list);
function w_of_default(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (orNine(e) === 9) count++;
      note(count);
    }
  }
}
out += "\nof_default: ";
for (const list of lists()) w_of_default(list);
function w_of_string(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (String(e) === "undefined") count++;
      note(count);
    }
  }
}
out += "\nof_string: ";
for (const list of lists()) w_of_string(list);
function w_of_chain(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (e?.toFixed === undefined) count++;
      note(count);
    }
  }
}
out += "\nof_chain: ";
for (const list of lists()) w_of_chain(list);
function w_of_inList(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if ([e].includes(undefined)) count++;
      note(count);
    }
  }
}
out += "\nof_inList: ";
for (const list of lists()) w_of_inList(list);
function w_of_isNaN(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (isNaN(e)) count++;
      note(count);
    }
  }
}
out += "\nof_isNaN: ";
for (const list of lists()) w_of_isNaN(list);
function w_of_notSelf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (e !== e) count++;
      note(count);
    }
  }
}
out += "\nof_notSelf: ";
for (const list of lists()) w_of_notSelf(list);
function w_of_not(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if (!e) count++;
      note(count);
    }
  }
}
out += "\nof_not: ";
for (const list of lists()) w_of_not(list);
function w_of_or(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list) if ((e || 50) === 50) count++;
      note(count);
    }
  }
}
out += "\nof_or: ";
for (const list of lists()) w_of_or(list);
function w_of_switch(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const e of list)
        if (
          (() => {
            switch (e) {
              case undefined:
                return true;
              default:
                return false;
            }
          })()
        )
          count++;
      note(count);
    }
  }
}
out += "\nof_switch: ";
for (const list of lists()) w_of_switch(list);
function w_findIndex_strict(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => e === undefined));
    }
  }
}
out += "\nfindIndex_strict: ";
for (const list of lists()) w_findIndex_strict(list);
function w_findIndex_loose(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => e == null));
    }
  }
}
out += "\nfindIndex_loose: ";
for (const list of lists()) w_findIndex_loose(list);
function w_findIndex_typeof(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => typeof e === "undefined"));
    }
  }
}
out += "\nfindIndex_typeof: ";
for (const list of lists()) w_findIndex_typeof(list);
function w_findIndex_void(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => e === void 0));
    }
  }
}
out += "\nfindIndex_void: ";
for (const list of lists()) w_findIndex_void(list);
function w_findIndex_is(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => Object.is(e, undefined)));
    }
  }
}
out += "\nfindIndex_is: ";
for (const list of lists()) w_findIndex_is(list);
function w_findIndex_coalesce(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => (e ?? 100) === 100));
    }
  }
}
out += "\nfindIndex_coalesce: ";
for (const list of lists()) w_findIndex_coalesce(list);
function w_findIndex_notNumber(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => typeof e !== "number"));
    }
  }
}
out += "\nfindIndex_notNumber: ";
for (const list of lists()) w_findIndex_notNumber(list);
function w_findIndex_default(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => orNine(e) === 9));
    }
  }
}
out += "\nfindIndex_default: ";
for (const list of lists()) w_findIndex_default(list);
function w_findIndex_string(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => String(e) === "undefined"));
    }
  }
}
out += "\nfindIndex_string: ";
for (const list of lists()) w_findIndex_string(list);
function w_findIndex_chain(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => e?.toFixed === undefined));
    }
  }
}
out += "\nfindIndex_chain: ";
for (const list of lists()) w_findIndex_chain(list);
function w_findIndex_inList(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => [e].includes(undefined)));
    }
  }
}
out += "\nfindIndex_inList: ";
for (const list of lists()) w_findIndex_inList(list);
function w_findIndex_isNaN(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => isNaN(e)));
    }
  }
}
out += "\nfindIndex_isNaN: ";
for (const list of lists()) w_findIndex_isNaN(list);
function w_findIndex_notSelf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => e !== e));
    }
  }
}
out += "\nfindIndex_notSelf: ";
for (const list of lists()) w_findIndex_notSelf(list);
function w_findIndex_not(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => !e));
    }
  }
}
out += "\nfindIndex_not: ";
for (const list of lists()) w_findIndex_not(list);
function w_findIndex_or(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findIndex(e => (e || 50) === 50));
    }
  }
}
out += "\nfindIndex_or: ";
for (const list of lists()) w_findIndex_or(list);
function w_findIndex_switch(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(
        list.findIndex(e =>
          (() => {
            switch (e) {
              case undefined:
                return true;
              default:
                return false;
            }
          })(),
        ),
      );
    }
  }
}
out += "\nfindIndex_switch: ";
for (const list of lists()) w_findIndex_switch(list);
function w_filter_strict(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => e === undefined).length);
    }
  }
}
out += "\nfilter_strict: ";
for (const list of lists()) w_filter_strict(list);
function w_filter_loose(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => e == null).length);
    }
  }
}
out += "\nfilter_loose: ";
for (const list of lists()) w_filter_loose(list);
function w_filter_typeof(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => typeof e === "undefined").length);
    }
  }
}
out += "\nfilter_typeof: ";
for (const list of lists()) w_filter_typeof(list);
function w_filter_void(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => e === void 0).length);
    }
  }
}
out += "\nfilter_void: ";
for (const list of lists()) w_filter_void(list);
function w_filter_is(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => Object.is(e, undefined)).length);
    }
  }
}
out += "\nfilter_is: ";
for (const list of lists()) w_filter_is(list);
function w_filter_coalesce(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => (e ?? 100) === 100).length);
    }
  }
}
out += "\nfilter_coalesce: ";
for (const list of lists()) w_filter_coalesce(list);
function w_filter_notNumber(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => typeof e !== "number").length);
    }
  }
}
out += "\nfilter_notNumber: ";
for (const list of lists()) w_filter_notNumber(list);
function w_filter_default(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => orNine(e) === 9).length);
    }
  }
}
out += "\nfilter_default: ";
for (const list of lists()) w_filter_default(list);
function w_filter_string(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => String(e) === "undefined").length);
    }
  }
}
out += "\nfilter_string: ";
for (const list of lists()) w_filter_string(list);
function w_filter_chain(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => e?.toFixed === undefined).length);
    }
  }
}
out += "\nfilter_chain: ";
for (const list of lists()) w_filter_chain(list);
function w_filter_inList(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => [e].includes(undefined)).length);
    }
  }
}
out += "\nfilter_inList: ";
for (const list of lists()) w_filter_inList(list);
function w_filter_isNaN(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => isNaN(e)).length);
    }
  }
}
out += "\nfilter_isNaN: ";
for (const list of lists()) w_filter_isNaN(list);
function w_filter_notSelf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => e !== e).length);
    }
  }
}
out += "\nfilter_notSelf: ";
for (const list of lists()) w_filter_notSelf(list);
function w_filter_not(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => !e).length);
    }
  }
}
out += "\nfilter_not: ";
for (const list of lists()) w_filter_not(list);
function w_filter_or(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.filter(e => (e || 50) === 50).length);
    }
  }
}
out += "\nfilter_or: ";
for (const list of lists()) w_filter_or(list);
function w_filter_switch(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(
        list.filter(e =>
          (() => {
            switch (e) {
              case undefined:
                return true;
              default:
                return false;
            }
          })(),
        ).length,
      );
    }
  }
}
out += "\nfilter_switch: ";
for (const list of lists()) w_filter_switch(list);
function w_some_strict(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => e === undefined));
    }
  }
}
out += "\nsome_strict: ";
for (const list of lists()) w_some_strict(list);
function w_some_loose(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => e == null));
    }
  }
}
out += "\nsome_loose: ";
for (const list of lists()) w_some_loose(list);
function w_some_typeof(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => typeof e === "undefined"));
    }
  }
}
out += "\nsome_typeof: ";
for (const list of lists()) w_some_typeof(list);
function w_some_void(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => e === void 0));
    }
  }
}
out += "\nsome_void: ";
for (const list of lists()) w_some_void(list);
function w_some_is(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => Object.is(e, undefined)));
    }
  }
}
out += "\nsome_is: ";
for (const list of lists()) w_some_is(list);
function w_some_coalesce(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => (e ?? 100) === 100));
    }
  }
}
out += "\nsome_coalesce: ";
for (const list of lists()) w_some_coalesce(list);
function w_some_notNumber(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => typeof e !== "number"));
    }
  }
}
out += "\nsome_notNumber: ";
for (const list of lists()) w_some_notNumber(list);
function w_some_default(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => orNine(e) === 9));
    }
  }
}
out += "\nsome_default: ";
for (const list of lists()) w_some_default(list);
function w_some_string(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => String(e) === "undefined"));
    }
  }
}
out += "\nsome_string: ";
for (const list of lists()) w_some_string(list);
function w_some_chain(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => e?.toFixed === undefined));
    }
  }
}
out += "\nsome_chain: ";
for (const list of lists()) w_some_chain(list);
function w_some_inList(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => [e].includes(undefined)));
    }
  }
}
out += "\nsome_inList: ";
for (const list of lists()) w_some_inList(list);
function w_some_isNaN(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => isNaN(e)));
    }
  }
}
out += "\nsome_isNaN: ";
for (const list of lists()) w_some_isNaN(list);
function w_some_notSelf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => e !== e));
    }
  }
}
out += "\nsome_notSelf: ";
for (const list of lists()) w_some_notSelf(list);
function w_some_not(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => !e));
    }
  }
}
out += "\nsome_not: ";
for (const list of lists()) w_some_not(list);
function w_some_or(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.some(e => (e || 50) === 50));
    }
  }
}
out += "\nsome_or: ";
for (const list of lists()) w_some_or(list);
function w_some_switch(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(
        list.some(e =>
          (() => {
            switch (e) {
              case undefined:
                return true;
              default:
                return false;
            }
          })(),
        ),
      );
    }
  }
}
out += "\nsome_switch: ";
for (const list of lists()) w_some_switch(list);
function w_findLast_strict(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => e === undefined));
    }
  }
}
out += "\nfindLast_strict: ";
for (const list of lists()) w_findLast_strict(list);
function w_findLast_loose(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => e == null));
    }
  }
}
out += "\nfindLast_loose: ";
for (const list of lists()) w_findLast_loose(list);
function w_findLast_typeof(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => typeof e === "undefined"));
    }
  }
}
out += "\nfindLast_typeof: ";
for (const list of lists()) w_findLast_typeof(list);
function w_findLast_void(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => e === void 0));
    }
  }
}
out += "\nfindLast_void: ";
for (const list of lists()) w_findLast_void(list);
function w_findLast_is(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => Object.is(e, undefined)));
    }
  }
}
out += "\nfindLast_is: ";
for (const list of lists()) w_findLast_is(list);
function w_findLast_coalesce(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => (e ?? 100) === 100));
    }
  }
}
out += "\nfindLast_coalesce: ";
for (const list of lists()) w_findLast_coalesce(list);
function w_findLast_notNumber(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => typeof e !== "number"));
    }
  }
}
out += "\nfindLast_notNumber: ";
for (const list of lists()) w_findLast_notNumber(list);
function w_findLast_default(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => orNine(e) === 9));
    }
  }
}
out += "\nfindLast_default: ";
for (const list of lists()) w_findLast_default(list);
function w_findLast_string(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => String(e) === "undefined"));
    }
  }
}
out += "\nfindLast_string: ";
for (const list of lists()) w_findLast_string(list);
function w_findLast_chain(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => e?.toFixed === undefined));
    }
  }
}
out += "\nfindLast_chain: ";
for (const list of lists()) w_findLast_chain(list);
function w_findLast_inList(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => [e].includes(undefined)));
    }
  }
}
out += "\nfindLast_inList: ";
for (const list of lists()) w_findLast_inList(list);
function w_findLast_isNaN(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => isNaN(e)));
    }
  }
}
out += "\nfindLast_isNaN: ";
for (const list of lists()) w_findLast_isNaN(list);
function w_findLast_notSelf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => e !== e));
    }
  }
}
out += "\nfindLast_notSelf: ";
for (const list of lists()) w_findLast_notSelf(list);
function w_findLast_not(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => !e));
    }
  }
}
out += "\nfindLast_not: ";
for (const list of lists()) w_findLast_not(list);
function w_findLast_or(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.findLastIndex(e => (e || 50) === 50));
    }
  }
}
out += "\nfindLast_or: ";
for (const list of lists()) w_findLast_or(list);
function w_findLast_switch(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(
        list.findLastIndex(e =>
          (() => {
            switch (e) {
              case undefined:
                return true;
              default:
                return false;
            }
          })(),
        ),
      );
    }
  }
}
out += "\nfindLast_switch: ";
for (const list of lists()) w_findLast_switch(list);
function w_down_strict(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (list[j] === undefined) count++;
      note(count);
    }
  }
}
out += "\ndown_strict: ";
for (const list of lists()) w_down_strict(list);
function w_down_loose(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (list[j] == null) count++;
      note(count);
    }
  }
}
out += "\ndown_loose: ";
for (const list of lists()) w_down_loose(list);
function w_down_typeof(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (typeof list[j] === "undefined") count++;
      note(count);
    }
  }
}
out += "\ndown_typeof: ";
for (const list of lists()) w_down_typeof(list);
function w_down_void(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (list[j] === void 0) count++;
      note(count);
    }
  }
}
out += "\ndown_void: ";
for (const list of lists()) w_down_void(list);
function w_down_is(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (Object.is(list[j], undefined)) count++;
      note(count);
    }
  }
}
out += "\ndown_is: ";
for (const list of lists()) w_down_is(list);
function w_down_coalesce(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if ((list[j] ?? 100) === 100) count++;
      note(count);
    }
  }
}
out += "\ndown_coalesce: ";
for (const list of lists()) w_down_coalesce(list);
function w_down_notNumber(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (typeof list[j] !== "number") count++;
      note(count);
    }
  }
}
out += "\ndown_notNumber: ";
for (const list of lists()) w_down_notNumber(list);
function w_down_default(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (orNine(list[j]) === 9) count++;
      note(count);
    }
  }
}
out += "\ndown_default: ";
for (const list of lists()) w_down_default(list);
function w_down_string(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (String(list[j]) === "undefined") count++;
      note(count);
    }
  }
}
out += "\ndown_string: ";
for (const list of lists()) w_down_string(list);
function w_down_chain(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (list[j]?.toFixed === undefined) count++;
      note(count);
    }
  }
}
out += "\ndown_chain: ";
for (const list of lists()) w_down_chain(list);
function w_down_inList(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if ([list[j]].includes(undefined)) count++;
      note(count);
    }
  }
}
out += "\ndown_inList: ";
for (const list of lists()) w_down_inList(list);
function w_down_isNaN(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (isNaN(list[j])) count++;
      note(count);
    }
  }
}
out += "\ndown_isNaN: ";
for (const list of lists()) w_down_isNaN(list);
function w_down_notSelf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (list[j] !== list[j]) count++;
      note(count);
    }
  }
}
out += "\ndown_notSelf: ";
for (const list of lists()) w_down_notSelf(list);
function w_down_not(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if (!list[j]) count++;
      note(count);
    }
  }
}
out += "\ndown_not: ";
for (const list of lists()) w_down_not(list);
function w_down_or(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--) if ((list[j] || 50) === 50) count++;
      note(count);
    }
  }
}
out += "\ndown_or: ";
for (const list of lists()) w_down_or(list);
function w_down_switch(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (let j = list.length - 1; j >= 0; j--)
        if (
          (() => {
            switch (list[j]) {
              case undefined:
                return true;
              default:
                return false;
            }
          })()
        )
          count++;
      note(count);
    }
  }
}
out += "\ndown_switch: ";
for (const list of lists()) w_down_switch(list);
function w_includes(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.includes(undefined));
    }
  }
}
out += "\nincludes: ";
for (const list of lists()) w_includes(list);
function w_indexOf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.indexOf(undefined));
    }
  }
}
out += "\nindexOf: ";
for (const list of lists()) w_indexOf(list);
function w_lastIndexOf(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.lastIndexOf(undefined));
    }
  }
}
out += "\nlastIndexOf: ";
for (const list of lists()) w_lastIndexOf(list);
function w_join(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.join("-"));
    }
  }
}
out += "\njoin: ";
for (const list of lists()) w_join(list);
function w_json(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(JSON.stringify(list));
    }
  }
}
out += "\njson: ";
for (const list of lists()) w_json(list);
function w_destructure(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      const [a = 10, b = 20, c = 30] = list;
      note(a + b + c);
    }
  }
}
out += "\ndestructure: ";
for (const list of lists()) w_destructure(list);
function w_at(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.at(-1) === undefined);
      note(list.at(0) === undefined);
    }
  }
}
out += "\nat: ";
for (const list of lists()) w_at(list);
function w_maxSpread(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(Math.max(...list));
    }
  }
}
out += "\nmaxSpread: ";
for (const list of lists()) w_maxSpread(list);
function w_mapJoin(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.map(e => (e === undefined ? 1 : 0)).join(""));
    }
  }
}
out += "\nmapJoin: ";
for (const list of lists()) w_mapJoin(list);
function w_entries(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const [at, e] of list.entries()) if (e === undefined) count += at + 1;
      note(count);
    }
  }
}
out += "\nentries: ";
for (const list of lists()) w_entries(list);
function w_forIn(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      let count = 0;
      for (const at in list) if (list[at] === undefined) count++;
      note(count);
    }
  }
}
out += "\nforIn: ";
for (const list of lists()) w_forIn(list);
function w_first(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list[0] === undefined);
      note(list[1] === undefined);
      note(list[2] === undefined);
    }
  }
}
out += "\nfirst: ";
for (const list of lists()) w_first(list);
function w_every(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.every(e => e !== undefined));
    }
  }
}
out += "\nevery: ";
for (const list of lists()) w_every(list);
function w_find(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.find(e => e === undefined || e > 5));
    }
  }
}
out += "\nfind: ";
for (const list of lists()) w_find(list);
function w_copy(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note([...list].indexOf(undefined));
      note(list.slice().includes(undefined));
    }
  }
}
out += "\ncopy: ";
for (const list of lists()) w_copy(list);
function w_sortless(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.toString());
    }
  }
}
out += "\nsortless: ";
for (const list of lists()) w_sortless(list);
function w_flat(list) {
  for (let round = 0; round < 2; round++) {
    {
      note(list.reduce((a, b) => a + b, 0));
    }
    {
      note(list.flat().length);
      note(list.concat([1]).includes(undefined));
    }
  }
}
out += "\nflat: ";
for (const list of lists()) w_flat(list);
console.log(out);
