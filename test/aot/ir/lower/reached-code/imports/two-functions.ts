export function used(): number {
  return helper() + 1;
}

export function unused(): number {
  return helperOfUnused() + 2;
}

function helper(): number {
  return 10;
}

function helperOfUnused(): number {
  return 20;
}
