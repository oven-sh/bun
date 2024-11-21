// import axios from "axios";

// const res = await axios.get("https://httpbin.org/status/500");
const res = await fetch("https://httpbin.org/status/500");

if (!res.ok) {
  throw new Error("Didn't work!");
}
