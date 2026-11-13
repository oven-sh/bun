export default function compareMultiple(object, other, orders) {
  let index = -1;
  const objCriteria = object.criteria, othCriteria = other.criteria, length = objCriteria.length;
  while (++index < length) {
    const x = objCriteria[index], y = othCriteria[index];
    if (x !== y) return (x < y ? -1 : 1) * (orders[index] == "desc" ? -1 : 1);
  }
  return object.index - other.index;
}
