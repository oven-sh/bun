import { make } from "./shared";
class Registry {
  static create(): Registry {
    return new Registry();
  }
  value = 41;
}
postMessage(make(Registry));
