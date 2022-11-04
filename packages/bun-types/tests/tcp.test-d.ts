import * as Bun from 'bun';

await Bun.connect({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  hostname: 'adsf',
  port: 324,
});

await Bun.connect({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  hostname: 'adsf',
  port: 324,
  tls: {
    certFile: 'asdf',
    keyFile: 'adsf',
  },
});

await Bun.connect({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  unix: 'asdf',
});

await Bun.connect({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  unix: 'asdf',
});

await Bun.listen({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  hostname: 'adsf',
  port: 324,
});

await Bun.listen({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  hostname: 'adsf',
  port: 324,
  tls: {
    certFile: 'asdf',
    keyFile: 'adsf',
  },
});

await Bun.listen({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  unix: 'asdf',
});

const listener = await Bun.listen({
  data: {arg: 'asdf'},
  socket: {
    data(socket) {
      socket.data.arg.toLowerCase();
    },
    open() {
      console.log('asdf');
    },
  },
  unix: 'asdf',
});

listener.data.arg = 'asdf';
// @ts-expect-error
listener.data.arg = 234;

// listener.reload({
//   data: {arg: 'asdf'},
// });

listener.reload({
  socket: {
    open() {},
    // ...listener.
  },
});
