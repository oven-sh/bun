// Output banner immediately before any requires
console.error("\nbun feedback - Send feedback to the Bun team\n");

const { readFileSync, existsSync, writeFileSync, fstatSync } = require("fs");
const { join } = require("path");

const VERSION = process.versions.bun || "unknown";
const OS = process.platform;
const ARCH = process.arch;

// Check if stdin is readable (not /dev/null or closed)
function isStdinReadable() {
  try {
    // Get file descriptor 0 (stdin)
    const stats = fstatSync(0);
    // Check if it's a regular file and has size 0 (like /dev/null)
    // or if it's not a character device/pipe/socket
    if (stats.isFile() && stats.size === 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function getEmail() {
  const bunInstall = process.env.BUN_INSTALL;

  // Check for saved email
  if (bunInstall) {
    const feedbackPath = join(bunInstall, "feedback");
    if (existsSync(feedbackPath)) {
      const savedEmail = readFileSync(feedbackPath, "utf8").trim();
      if (savedEmail) {
        return savedEmail;
      }
    }
  }

  // Try to get email from git config
  let defaultEmail = "";
  try {
    const result = Bun.spawnSync(["git", "config", "user.email"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode === 0 && result.stdout) {
      defaultEmail = result.stdout.toString().trim();
    }
  } catch {}

  // If stdin is not readable (e.g., /dev/null), return default or empty
  if (!isStdinReadable()) {
    return defaultEmail || "";
  }

  // Prompt for email
  process.stderr.write(`? Email address${defaultEmail ? ` (${defaultEmail})` : ""}: `);

  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    const line = decoder.decode(chunk).trim();
    const email = line || defaultEmail;

    // Save email if BUN_INSTALL is set
    if (bunInstall && email) {
      const feedbackPath = join(bunInstall, "feedback");
      try {
        writeFileSync(feedbackPath, email);
      } catch {}
    }

    return email;
  }

  return defaultEmail;
}

async function getBody() {
  // Get args from process.argv
  // process.argv[0] = bun executable, process.argv[1+] = actual args
  const args = process.argv.slice(1);

  // If we have positional arguments, use them
  if (args.length > 0) {
    return args.join(" ");
  }

  // Check if stdin is readable
  if (!isStdinReadable()) {
    return "";
  }

  // If stdin is not a TTY, read from pipe
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return buffer.toString("utf8").trim();
  }

  // Otherwise prompt for message
  process.stderr.write("? Feedback message (Press Enter to submit): ");

  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    return decoder.decode(chunk).trim();
  }

  return "";
}

async function sendFeedback(email, body) {
  const url = process.env.BUN_FEEDBACK_URL || "https://bun.com/api/v1/feedback";

  const payload = JSON.stringify({
    os: OS,
    cpu: ARCH,
    version: VERSION,
    body,
    email,
  });

  // Show progress
  process.stderr.write("Sending feedback...");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
    });

    process.stderr.write("\r\x1b[K"); // Clear the line

    if (response.ok) {
      console.error("\n✓ Thank you for your feedback!\n");
    } else {
      console.error(`\nerror: Failed to send feedback (status code: ${response.status})\n`);
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write("\r\x1b[K"); // Clear the line
    console.error(`\nerror: Failed to send feedback: ${error?.message || error}\n`);
    process.exit(1);
  }
}

(async () => {
  try {
    // Get email
    const email = await getEmail();

    // Get feedback body
    const body = await getBody();

    if (!body) {
      console.error("error: No feedback message provided");
      process.exit(1);
    }

    // Send feedback
    await sendFeedback(email, body);
  } catch (err) {
    console.error("error: Unexpected error in feedback command:", err);
    process.exit(1);
  }
})();