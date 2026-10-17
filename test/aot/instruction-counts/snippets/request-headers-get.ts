// reads two headers of a Request by constant names
const operations = 20;
const requests = [1, 2, 3, 4].map((n) => new Request("http://localhost/" + n, { headers: { authorization: "Bearer " + n, accept: "*/*", "x-request-id": "r" + n } }));
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const request = requests[i & 3];
    sum += request.headers.get("authorization")!.length + (request.headers.get("x-absent") === null ? 1 : 0);
  }
}

console.log(sum);
