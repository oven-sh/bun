class LazyQuery {
  constructor(text, result) {
    this.text = text;
    this.result = result;
  }
  then(onFulfilled, onRejected) {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
  catch(onRejected) {
    return this.then(undefined, onRejected);
  }
  finally(onFinally) {
    return this.then().finally(onFinally);
  }
  get [Symbol.toStringTag]() {
    return "LazyQuery";
  }
}
export function query(text, result) {
  return new LazyQuery(text, result);
}
