const shared = { list: [1, 2, 3] };

export function replaceShared(value) {
  shared[["li", "st"].join("")] = value;
}

export default shared;
