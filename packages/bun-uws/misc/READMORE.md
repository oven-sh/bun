# µWebSockets v19 user manual

For a list of frequently asked questions you may use the Discussions tab here on GitHub. Please don't misuse the issue tracker as your personal Q&A, we use it only for bug reporting. Discussions tab is less strict about content.

## Motivation and goals

µWebSockets is a simple to use yet thoroughly optimized, standards compliant and secure implementation of WebSockets (and HTTP).
It comes with built-in pub/sub support, URL routing, TLS 1.3, SNI, IPv6, permessage-deflate and is battle tested as one of the most popular implementations, reaching many millions of end-users daily. It's currently juggling billions of USD in many popular Bitcoin exchanges, every day with outstanding real-world performance.

### Standards compliant

Unlike other "pub/sub brokers", µWS does not assume or push any particular application protocol but only operates over raw, standard WebSockets. You need nothing but a standards compliant web browser and a handful of standards compliant JavaScript to communicate with it. No particular client library is needed or enforced - this unlike inadequate solutions like Socket.IO where you end up locked to a set of proprietary non-standard protocols with horrible performance.

### Performant

The implementation is header-only C++17 (but examples use C++20 features for brevity and elegance!), cross-platform and compiles down to a tiny binary of a handful kilobytes.
It depends on µSockets, which is a standard C project for Linux, macOS & Windows.

Performance wise you can expect to outperform, or equal, just about anything similar out there, that's the fundamental goal of the project. I can show small-message cases where µWS **with SSL** significantly outperforms the fastest Golang servers running **non-SSL**. You get the SSL for free in a sense (shown to be true for messaging with up to 4 kB per message).

We've [openly presented](https://medium.com/swlh/100k-secure-websockets-with-raspberry-pi-4-1ba5d2127a23) detailed cases where a single Raspberry Pi 4 can serve more than 100k very active TLS 1.3 WebSockets, simultaneously, with excellent stability. This is entirely impossible with the vast majority of alternative solutions. Most solutions cramp up and become unreliable at a tiny fraction of this load, on such a limited hardware. We also have measurements where we [serve 12x the HTTP requests per second](https://levelup.gitconnected.com/serving-100k-requests-second-from-a-fanless-raspberry-pi-4-over-ethernet-fdd2c2e05a1e) as compared to Node.js.

### Simple to use

Another goal of the project is minimalism, simplicity and elegance.
Design wise it follows an ExpressJS-like interface where you attach callbacks to different URL routes.
This way you can easily build complete REST/WebSocket services in a few lines of code.

Boilerplate logic like heartbeat timeouts, backpressure handling, ping/pong and other annoyances are handled efficiently and easily by the library itself. You write business logic, the library handles the protocol(s).

The project is async only and runs local to one thread. You scale it as individual threads much like Node.js scales as individual processes. That is, the implementation only sees a single thread and is not thread-safe. There are simple ways to do threading via async delegates though, if you really need to.

## Compiling

µWebSockets is 100% standard header-only C++17 - it compiles on any platform. However, it depends on µSockets in all cases, which is platform-specific C code that runs on Linux, Windows and macOS.

There are a few compilation flags for µSockets (see its documentation), but common between µSockets and µWebSockets flags are as follows:

- LIBUS_NO_SSL - disable OpenSSL dependency/functionality for uSockets and uWebSockets builds
- UWS_NO_ZLIB - disable Zlib dependency/functionality for uWebSockets

You can use the Makefile on Linux and macOS. It is simple to use and builds the examples for you. `WITH_OPENSSL=1 make` builds all examples with SSL enabled. Examples will fail to listen if cert and key cannot be found, so make sure to specify a path that works for you.

## User manual

### uWS::App & uWS::SSLApp

You begin your journey by constructing an "App". Either an SSL-app or a regular TCP-only App. The uWS::SSLApp constructor takes a struct holding SSL options such as cert and key. Interfaces for both apps are identical, so let's call them both "App" from now on.

Apps follow the builder pattern, member functions return the App so that you can chain calls.

### App.get, post, put, [...] and any routes

You attach behavior to "URL routes". A lambda is paired with a "method" (Http method that is) and a pattern (the URL matching pattern).

Methods are many, but most common are probably get & post. They all have the same signature, let's look at one example:

```c++
uWS::App().get("/hello", [](auto *res, auto *req) {
    res->end("Hello World!");
});
```

Important for all routes is that "req", the `uWS::HttpRequest *` dies with return. In other words, req is stack allocated so don't keep it in your pocket.

res, the `uWS::HttpResponse<SSL> *` will be alive and accessible until either its .onAborted callback emits, or you've responded to the request via res.end or res.tryEnd.

In other words, you either respond to the request immediately and return, or you attach lambdas to the res (which may hold captured data), and respond later on in some other async callback.

Data that you capture in a res follows RAII and is move-only so you can properly move-in for instance std::string buffers that you may use to, for instance, buffer upp streaming POST data. It's pretty cool, check out mutable lambdas with move-only captures.

The "any" route will match any method.

#### Pattern matching

Routes are matched in **order of specificity**, not by the order you register them:

- Highest priority - static routes, think "/hello/this/is/static".
- Middle priority - parameter routes, think "/candy/:kind", where value of :kind is retrieved by req.getParameter(0).
- Lowest priority - wildcard routes, think "/hello/\*".

In other words, the more specific a route is, the earlier it will match. This allows you to define wildcard routes that match a wide range of URLs and then "carve" out more specific behavior from that.

"Any" routes, those who match any HTTP method, will match with lower priority than routes which specify their specific HTTP method (such as GET) if and only if the two routes otherwise are equally specific.

#### Middlewares

A very commonly asked question is how to achieve something like middlewares. We don't support middlewares as something built into the router itself. Partly because routes cannot pass data to other routes, partly because the HttpRequest object being stack-allocated and only valid in one single callback invocation, but most importantly - you can **easily** achieve the same function-chaining that is middlewares by instead using simple high-order functions and functional programming. There are tons of examples of this under Discussions (since it is a commonly asked question). A middleware isn't really something that has to be built-in to the server library itself, it really is just **a regular function**. By passing functions to other functions you can build chains of behaviors in very elegant and efficient ways.

Whether this library should keep a set of commonly used functions is another question - we might do that in the future and we might add an example of its usage but right now there is nothing like this provided. We aim to provide an easy to use server implementation that you can build things on. Not complete business logic puzzle pieces.

#### Streaming data

You should never call res.end(huge buffer). res.end guarantees sending so backpressure will probably spike. Instead you should use res.tryEnd to stream huge data part by part. Use in combination with res.onWritable and res.onAborted callbacks.

Tip: Check out the JavaScript project, it has many useful examples of async streaming of huge data.

#### Corking

It is very important to understand the corking mechanism, as that is responsible for efficiently formatting, packing and sending data. Without corking your app will still work reliably, but can perform very bad and use excessive networking. In some cases the performance can be dreadful without proper corking.

That's why your sockets will be corked by default in most simple cases, including all of the examples provided. However there are cases where default corking cannot happen automatically.

- Whenever your registered business logic (your callbacks) are called from the library, such as when receiving a message or when a socket opens, you'll be corked by default. Whatever you do with the socket inside of that callback will be efficient and properly corked.

- If you have callbacks registered to some other library, say libhiredis, those callbacks will not be called with corked sockets (how could **we** know when to cork the socket if we don't control the third-party library!?).

- Only one single socket can be corked at any point in time (isolated per thread, of course). It is efficient to cork-and-uncork.

- Whenever your callback is a coroutine, such as the JavaScript async/await, automatic corking can only happen in the very first portion of the coroutine (consider await a separator which essentially cuts the coroutine into smaller segments). Only the first "segment" of the coroutine will be called from µWS, the following async segments will be called by the JavaScript runtime at a later point in time and will thus not be under our control with default corking enabled.

- Corking is important even for calls which seem to be "atomic" and only send one chunk. res->end, res->tryEnd, res->writeStatus, res->writeHeader will most likely send multiple chunks of data and is very important to properly cork.

You can make sure corking is enabled, even for cases where default corking would be enabled, by wrapping whatever sending function calls in a lambda like so:

```c++
res->cork([]() {
    res->end("This Http response will be properly corked and efficient in all cases");
});
```

The above res->end call will actually call three separate send functions; res->writeStatus, res->writeHeader and whatever it does itself. By wrapping the call in res->cork you make sure these three send functions are efficient and only result in one single send syscall and one single SSL block if using SSL.

Keep this in mind, corking is by far the single most important performance trick to use. Even when streaming huge amounts of data it can be useful to cork. At least in the very tip of the response, as that holds the headers and status.

### The App.ws route

WebSocket "routes" are registered similarly, but not identically.

Every websocket route has the same pattern and pattern matching as for Http, but instead of one single callback you have a whole set of them, here's an example:

```c++
uWS::App().ws<PerSocketData>("/*", {
    /* Settings */
    .compression = uWS::SHARED_COMPRESSOR,
    .maxPayloadLength = 16 * 1024,
    .idleTimeout = 10,
    /* Handlers */
    .upgrade = [](auto *res, auto *req, auto *context) {
        /* You may read from req only here, and COPY whatever you need into your PerSocketData.
         * See UpgradeSync and UpgradeAsync examples. */
    },
    .open = [](auto *ws) {

    },
    .message = [](auto *ws, std::string_view message, uWS::OpCode opCode) {
        ws->send(message, opCode);
    },
    .drain = [](auto *ws) {
        /* Check getBufferedAmount here */
    },
    .ping = [](auto *ws) {

    },
    .pong = [](auto *ws) {

    },
    .close = [](auto *ws, int code, std::string_view message) {

    }
});
```

WebSocket routes specify a user data type that should be used to keep per-websocket data. Many times people tend to attach user data
which should belong to the websocket by putting the pointer and the user data in a std::map. That's wrong! Don't do that!

#### Use the WebSocket.getUserData() feature

You should use the provided user data feature to store and attach any per-socket user data. Going from user data to WebSocket is possible if you make your user data hold a pointer to WebSocket, and hook things up in the WebSocket open handler. Your user data memory is valid while your WebSocket is.

If you want to create something more elaborate you could have the user data hold a pointer to some dynamically allocated memory block that keeps a boolean whether the WebSocket is still valid or not. Sky is the limit here, you should never need any std::map for this.

#### WebSockets are valid from open to close

All given WebSocket pointers are guaranteed to live from open event (where you got your WebSocket) until close event is called. So is the user data memory. One open event will always end in exactly one close event, they are 1-to-1 and will always be balanced no matter what. Use them to drive your RAII data types, they can be seen as constructor and destructor.

Message events will never emit outside of open/close. Calling WebSocket.close or WebSocket.end will immediately call the close handler.

#### Backpressure in websockets

Similarly to for Http, methods such as ws.send(...) can cause backpressure. Make sure to check ws.getBufferedAmount() before sending, and check the return value of ws.send before sending any more data. WebSockets do not have .onWritable, but instead make use of the .drain handler of the websocket route handler.

Inside of .drain event you should check ws.getBufferedAmount(), it might have drained, or even increased. Most likely drained but don't assume that it has, .drain event is only a hint that it has changed.

#### Ping/pongs "heartbeats"

The library will automatically send pings to clients according to the `idleTimeout` specified. If you set idleTimeout = 120 seconds a ping will go out a few seconds before this timeout unless the client has sent something to the server recently. If the client responds to the ping, the socket will stay open. When client fails to respond in time, the socket will be forcefully closed and the close event will trigger. On disconnect all resources are freed, including subscriptions to topics and any backpressure. You can easily let the browser reconnect using 3-lines-or-so of JavaScript if you want to.

#### Backpressure

Sending on a WebSocket can build backpressure. WebSocket::send returns an enum of BACKPRESSURE, SUCCESS or DROPPED. When send returns BACKPRESSURE it means you should stop sending data until the drain event fires and WebSocket::getBufferedAmount() returns a reasonable amount of bytes. But in case you specified a maxBackpressure when creating the WebSocketContext, this limit will automatically be enforced. That means an attempt at sending a message which would result in too much backpressure will be canceled and send will return DROPPED. This means the message was dropped and will not be put in the queue. maxBackpressure is an essential setting when using pub/sub as a slow receiver otherwise could build up a lot of backpressure. By setting maxBackpressure the library will automatically manage an enforce a maximum allowed backpressure per socket for you.

#### Threading

The library is single threaded. You cannot, absolutely not, mix threads. A socket created from an App on thread 1 cannot be used in any way from thread 2. The only function in the whole entire library which is thread-safe and can be used from any thread is Loop:defer. Loop::defer takes a function (such as a lambda with data) and defers the execution of said function until the specified loop's thread is ready to execute the function in a single-threaded fashion on correct thread. So in case you want to publish a message under a topic, or send on some other thread's sockets you can, but it requires a bit of indirection. You should aim for having as isolated apps and threads as possible.

#### Settings

Compression (permessage-deflate) has three main modes; uWS::DISABLED, uWS::SHARED_COMPRESSOR and any of the uWS::DEDICATED_COMPRESSOR_xKB. Disabled and shared options require no memory, while dedicated compressor requires the amount of memory you selected. For instance, uWS::DEDICATED_COMPRESSOR_4KB adds an overhead of 4KB per WebSocket while uWS::DEDICATED_COMPRESSOR_256KB adds - you guessed it - 256KB!

Compressing using shared means that every WebSocket message is an isolated compression stream, it does not have a sliding compression window, kept between multiple send calls like the dedicated variants do.

You probably want shared compressor if dealing with larger JSON messages, or 4kb dedicated compressor if dealing with smaller JSON messages and if doing binary messaging you probably want to disable it completely.

- idleTimeout is roughly the amount of seconds that may pass between messages. Being idle for more than this, and the connection is severed. This means you should make your clients send small ping messages every now and then, to keep the connection alive. You can also make the server send ping messages but I would definitely put that labor on the client side. (outdated text - this is not entirely true anymore. The server will automatically send pings in case it needs to).

### Listening on a port

Once you have defined your routes and their behavior, it is time to start listening for new connections. You do this by calling

```c++
App.listen(port, [](auto *listenSocket) {
    /* listenSocket is either nullptr or us_listen_socket */
})
```

Canceling listening is done with the uSockets function call `us_listen_socket_close`.

### App.run and fallthrough

When you are done and want to enter the event loop, you call, once and only once, App.run.
This will block the calling thread until "fallthrough". The event loop will block until no more async work is scheduled, just like for Node.js.

Many users ask how they should stop the event loop. That's not how it is done, you never stop it, you let it fall through. By closing all sockets, stopping the listen socket, removing any timers, etc, the loop will automatically cause App.run to return gracefully, with no memory leaks.

Because the App itself is under RAII control, once the blocking .run call returns and the App goes out of scope, all memory will gracefully be deleted.

### Putting it all together

```c++
int main() {
    uWS::App().get("/*", [](auto *res, auto *req) {
        res->end("Hello World!");
    }).listen(9001, [](auto *listenSocket) {
        if (listenSocket) {
            std::cout << "Listening for connections..." << std::endl;
        }
    }).run();

    std::cout << "Shoot! We failed to listen and the App fell through, exiting now!" << std::endl;
}
```

### Scaling up

One event-loop per thread, isolated and without shared data. That's the design here. Just like Node.js, but instead of per-process, it's per thread (well, obviously you can do it per-process also).

If you want to, you can simply take the previous example, put it inside of a few `std::thread` and listen to separate ports, or share the same port (works on Linux). More features like these will probably come, such as master/slave set-ups but it really isn't that hard to understand the concept - keep things isolated and spawn multiple instances of whatever code you have.

Recent Node.js versions may scale using multiple threads, via the new Worker threads support. Scaling using that feature is identical to scaling using multiple threads in C++.

### Compression

We aren't as careful with resources as we used to be. Just look at, how many web developers represent time - it is not uncommon for web developers to send an entire textual representation of time as 30-something actual letters inside a JSON document with an actual textual key. This is just awful. We have had standardized, time-zone neutral representation of time in binary, efficient, 4-byte (or more commonly the 8 byte variant) representation since the 1970s. It's called unix timestamp and is an elegant and efficient way of representing time-zone neutral time down to the seconds.

This is just an example of how we have regressed in our algorithmic thinking. Today it is common to use textual representations such as bloated JSON to represent data, even though most of that bloat is obvious repetitions and inefficient in nature. But we don't care because we have compression. True, even the most bloated source format can be compressed down to a small payload with few repetitions - however - this comes at TREMENDOUS cost.

Compression should be seen as a last resort, a temporary duct-tape solution for when you cannot sit down and consider something better. Designing clever, binary and minimally repetitive protocols saves enormous amounts of CPU-time otherwise lost to compression.

In essence, compression is really just dynamically scanning for repetitions and gradually building up a dynamic palette of commonly repetitive chunks. That takes a lot of CPU-time and is incredibly inefficient. Overall, you're looking at only 20-30% remaining I/O performance if you use compression. Instead of letting some generic dynamic algorithm scan your inefficient data representation, you could have taken the time to design something that didn't suck in the first place.

You could have defined a static palette and referenced that efficiently using binary integers, instead of letting every single individual socket try and dynamically figure out and build that palette, dynamically and inefficiently, in its own memory consuming sliding window.

ProtoBuf and the like, where integral references can be used instead of textual strings is key if you plan on making something efficient. If you plan on using JSON that has to be compressed you might as well just shove your computer down a shredder and go do something else. That's my opinion and I have many of those.

It is true that we can do more permessage-deflate messages/second than many other solutions can do uncompressed messages/second, and yes we are entirely stable while doing so - but still - JSON is terrible.

So you might say - hey - that's too complex. Well build an SDK for your users then. Just wrap that "complex" protocol up in a JavaScript library that internally knows about this palette and exposes only simple-to-use functions for the end user. It's not that hard of a problem to solve.

##### What about TLS/SSL then? I still have to encrypt!

TLS is nothing like compression. With TLS 1.3 you're still looking at around 80% performance retention over non-TLS. This because TLS is block based and efficiently maps to modern CPUs. Modern CPUs also have hardware offloads for this. It's not that demanding to encrypt traffic using modern encryption standards. Compression is by far the most CPU-demanding thing you can do with your connection, and it requires TONS of per-socket memory.
