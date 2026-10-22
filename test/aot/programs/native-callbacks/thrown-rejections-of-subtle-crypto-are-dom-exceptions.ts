// Thrown values: crypto.subtle rejects with a DOMException that native code made, whose `code` is a number of another meaning than that of the program's own error class, for which the handler is typed.
export {};

class Failure extends Error {
  code = 7;
}

const names: string[] = [];

function onFailure(failure: Failure): number {
  names.push(failure.name);
  if (failure instanceof Failure) return failure.code;
  const other = failure as Failure;
  return (other as any) instanceof DOMException ? 100 + other.code : 10000;
}

let total = onFailure(new Failure("own"));
total += (await crypto.subtle.digest("no such digest", new Uint8Array(1)).catch(onFailure)) as number;
total += (await crypto.subtle.importKey("raw", new Uint8Array(1), "no such algorithm", false, []).catch(onFailure)) as number;
total += (await crypto.subtle.digest("SHA-256", new Uint8Array(1))).byteLength;
console.log(total, names.join());
