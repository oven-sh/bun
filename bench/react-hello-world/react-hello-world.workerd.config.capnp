using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .mainWorker),
  ],

  sockets = [
    ( name = "http",
      address = "*:3001",
      http = (),
      service = "main"
    ),
  ]
);

const mainWorker :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "react-hello-world.workerd.js"),
  ],
  compatibilityDate = "2025-01-01",
  compatibilityFlags = ["nodejs_compat_v2"],
);
