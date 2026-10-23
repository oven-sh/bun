// The receiver's type arguments may be inferred, so they do not instantiate the written result of the call. They do instantiate the signature.
interface Box<T> {
  get(): T;
}
declare const box: Box<number>;
box.get();
