// await Bun.sleep(100);

interface User {
  name: string;
}

const user = {
  name: "Alistair",
} as User;

console.log(`First letter us '${user.name.charAt(0)}'`);

await Bun.sleep(100);
