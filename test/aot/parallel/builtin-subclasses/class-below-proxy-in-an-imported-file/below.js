class Below extends Proxy {
  static answer() {
    return 42;
  }
}
export const answer = Below.answer();
