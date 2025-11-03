function loadScript(url, callback) {
  const script = document.createElement("script");
  script.src = url;
  script.type = "text/javascript";
  script.onload = callback;
  document.head.appendChild(script);
}

loadScript(
  "https://cdn.jsdelivr.net/npm/@inkeep/cxkit-mintlify@0.5/dist/index.js",
  () => {
    const settings = {
      baseSettings: {
        apiKey: "f38a3d4e0a621e192a5d161c6f4babd951fdfc20854bc4b0", // required
        primaryBrandColor: "#F267AD", // required -- your brand color, the color scheme is derived from this
        organizationDisplayName: "Bun",
      },
      aiChatSettings: {
        aiAssistantAvatar: "https://storage.googleapis.com/organization-image-assets/bun-botAvatarSrcUrl-1705417749067.svg",
        chatSubjectName: "Bun",
        exampleQuestions: [
          "Can I use Bun with my existing Node.js project?",
          "How is Bun faster than Node.js? How can I benchmark it?",
          "Do I still need a bundler or TypeScript compiler?",
        ],
        getHelpOptions: [
          {
            icon: {
              builtIn: "FaDiscord"
            },
            name: "Discord",
            action: {
              type: "open_link",
              url: "https://bun.com/discord"
            }
          },
          {
            icon: {
              builtIn: "FaBriefcase"
            },
            name: "Migration help for organizations",
            action: {
              type: "open_link",
              url: "https://t.co/0CA0Neqgts"
            }
          }
        ]
      },
      canToggleView: false, // set to true to enable search
    };

    // Initialize the UI components
    Inkeep.ChatButton(settings); // 'Ask AI' button
  }
);