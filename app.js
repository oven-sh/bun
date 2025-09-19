export default {
  port: 3000,
  fetch() {
    import('./nonexistent.js');
    return new Response('hello');
  }
}
