// tests an optional string for truth, outside loops
const operations = 4;
let present: string | undefined = process.argv.length > 50 ? undefined : "present";
let absent: string | undefined = process.argv.length > 50 ? "absent" : undefined;
let total = 0;

kernel: {
  if (present) total += 1;
  if (absent) total += 2;
  if (!present) total += 3;
  if (!absent) total += 4;
}

console.log(total);
