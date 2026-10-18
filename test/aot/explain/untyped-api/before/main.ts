interface Config {
  host: string;
  port: number;
}

const config = await Bun.file("config.json").json();
console.log(config.host + ":" + config.port);
