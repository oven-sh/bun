export default {
  fetch(request) {
    return new Response(a());
  },
};

function a() {
  return b();
}

function b() {
  return c();
}

function c() {
  function d() {
    return "hello";
  }
  return d();
}
