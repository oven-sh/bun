// RUN: lower
// CHECK-LABEL: function {{*}}name="read"{{*}}IsAsync
// CHECK: = Await

// RUN(CONVERSIONS): lower
// CONVERSIONS-NOT: Convert

export async function read(promise) {
  return await promise;
}
