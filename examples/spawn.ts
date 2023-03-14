import { spawn, which } from "bun";
import { rmSync } from "fs";
import { basename } from "path";

const repo = process.argv.at(3) || "TheoBr/vercel-vite-demo";

const target = basename(repo) + "-main";
console.log("Downloading", repo, "to", "/tmp/" + target);

const archive = await fetch(`https://github.com/${repo}/archive/refs/heads/main.tar.gz`);

// remove the directory if it already exists locally
rmSync("/tmp/" + target, { recursive: true, force: true });

const tar = spawn({
  cmd: ["tar", "-xzf", "-"],
  stdin: archive.body,

  stderr: "inherit",
  stdout: "inherit",
  cwd: "/tmp",
});

await tar.exited;

// if vercel isn't installed, install it
if (!which("vercel")) {
  console.log("Installing vercel...");

  const installer = spawn(["bun", "install", "-g", "vercel"], {
    stderr: "inherit",
    stdout: "inherit",
    stdin: "inherit",
  });
  await installer.exited;

  if (!which("vercel")) {
    throw new Error("Failed to install Vercel CLI");
  }
}

const { exited: deployed } = spawn({
  cmd: ["vercel", "deploy", "--yes", "--public", target],
  stdio: ["inherit", "inherit", "inherit"],
  cwd: "/tmp",
});

await deployed;
