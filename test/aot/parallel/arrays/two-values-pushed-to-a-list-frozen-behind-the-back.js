// a list that has taken two values a turn is frozen through a function that the build cannot name: the next push throws and stores nothing
// COUNT: operation:operationAOTArrayPushTwo >= 300
const hidden = JSON.parse('{"freeze":"freeze"}');
const box = JSON.parse('{"lists":[[],[0.5],["a"]]}');
function pushedTwo(list, first, second) {
  const length = list.push(first, second);
  return String(length);
}
function deed(list) {
  Object[hidden.freeze](list);
}
for (let i = 0; i < box.lists.length; i++) console.log(pushedTwo(box.lists[i], i, "b"));
for (let i = 0; i < 300; i++) pushedTwo(box.lists[i % box.lists.length], i, i + 0.5);
for (let i = 0; i < box.lists.length; i++) console.log(String(box.lists[i].length) + " " + box.lists[i].slice(0, 5).join());
deed(box.lists[1]);
for (let i = 0; i < box.lists.length; i++) {
  try {
    console.log(pushedTwo(box.lists[i], "x", "y"));
  } catch (error) {
    console.log(error.name + " " + String(box.lists[i].length));
  }
}
