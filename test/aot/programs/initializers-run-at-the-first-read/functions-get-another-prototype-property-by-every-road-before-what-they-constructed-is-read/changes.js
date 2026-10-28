import { Third } from "./declared.js";
Third.prototype = {
  read() {
    return "second";
  },
};
