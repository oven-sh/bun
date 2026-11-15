const USER = { profile: { address: null, emails: ["a@b.c"] }, settings: undefined };
console.log(USER.profile?.address?.city ?? "no city", USER.settings?.theme ?? "default", USER.profile.emails?.[0], USER.nothing?.(), USER.profile.emails.at?.(-1));
