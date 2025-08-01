import axios from "axios";

async function foo() {
  const res = await axios.get("http://example.com");

  throw new Error("potato");
}

console.log(await foo());
