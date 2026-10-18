interface Config {
  host: string;
  port: number;
}

const config = JSON.parse<Config>(await Bun.file("config.json").text());
console.log(config.host + ":" + config.port);
