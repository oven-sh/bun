/// Well-known SMTP service configurations (ported from nodemailer)
pub const ServiceConfig = struct {
    host: []const u8,
    port: u16,
    secure: bool,
};

/// Lookup a well-known SMTP service by name or email domain.
/// Returns null if not found.
pub fn lookup(key: []const u8) ?ServiceConfig {
    // Normalize: lowercase, strip non-alnum except . and -
    var buf: [128]u8 = undefined;
    var len: usize = 0;
    for (key) |c| {
        if (len >= buf.len) break;
        if (c >= 'A' and c <= 'Z') {
            buf[len] = c + 32;
            len += 1;
        } else if ((c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '.' or c == '-') {
            buf[len] = c;
            len += 1;
        }
    }
    const normalized = buf[0..len];

    return services.get(normalized);
}

const S = ServiceConfig;

const services = bun.ComptimeStringMap(ServiceConfig, .{
    .{ "gmail", S{ .host = "smtp.gmail.com", .port = 465, .secure = true } },
    .{ "googlemail", S{ .host = "smtp.gmail.com", .port = 465, .secure = true } },
    .{ "gmail.com", S{ .host = "smtp.gmail.com", .port = 465, .secure = true } },
    .{ "googlemail.com", S{ .host = "smtp.gmail.com", .port = 465, .secure = true } },

    .{ "outlook365", S{ .host = "smtp.office365.com", .port = 587, .secure = false } },
    .{ "outlook", S{ .host = "smtp-mail.outlook.com", .port = 587, .secure = false } },
    .{ "hotmail", S{ .host = "smtp-mail.outlook.com", .port = 587, .secure = false } },
    .{ "live", S{ .host = "smtp-mail.outlook.com", .port = 587, .secure = false } },
    .{ "outlook.com", S{ .host = "smtp-mail.outlook.com", .port = 587, .secure = false } },
    .{ "hotmail.com", S{ .host = "smtp-mail.outlook.com", .port = 587, .secure = false } },
    .{ "live.com", S{ .host = "smtp-mail.outlook.com", .port = 587, .secure = false } },

    .{ "yahoo", S{ .host = "smtp.mail.yahoo.com", .port = 465, .secure = true } },
    .{ "yahoo.com", S{ .host = "smtp.mail.yahoo.com", .port = 465, .secure = true } },

    .{ "icloud", S{ .host = "smtp.mail.me.com", .port = 587, .secure = false } },
    .{ "me.com", S{ .host = "smtp.mail.me.com", .port = 587, .secure = false } },
    .{ "icloud.com", S{ .host = "smtp.mail.me.com", .port = 587, .secure = false } },

    .{ "aol", S{ .host = "smtp.aol.com", .port = 587, .secure = false } },
    .{ "aol.com", S{ .host = "smtp.aol.com", .port = 587, .secure = false } },

    .{ "fastmail", S{ .host = "smtp.fastmail.com", .port = 465, .secure = true } },
    .{ "fastmail.fm", S{ .host = "smtp.fastmail.com", .port = 465, .secure = true } },

    .{ "zoho", S{ .host = "smtp.zoho.com", .port = 465, .secure = true } },
    .{ "zohomail", S{ .host = "smtp.zoho.com", .port = 465, .secure = true } },
    .{ "zoho.com", S{ .host = "smtp.zoho.com", .port = 465, .secure = true } },

    .{ "protonmail", S{ .host = "127.0.0.1", .port = 1025, .secure = false } },
    .{ "proton", S{ .host = "127.0.0.1", .port = 1025, .secure = false } },

    .{ "mailgun", S{ .host = "smtp.mailgun.org", .port = 465, .secure = true } },
    .{ "sendgrid", S{ .host = "smtp.sendgrid.net", .port = 587, .secure = false } },

    .{ "ses", S{ .host = "email-smtp.us-east-1.amazonaws.com", .port = 465, .secure = true } },
    .{ "ses-us-east-1", S{ .host = "email-smtp.us-east-1.amazonaws.com", .port = 465, .secure = true } },
    .{ "ses-us-west-2", S{ .host = "email-smtp.us-west-2.amazonaws.com", .port = 465, .secure = true } },
    .{ "ses-eu-west-1", S{ .host = "email-smtp.eu-west-1.amazonaws.com", .port = 465, .secure = true } },

    .{ "postmark", S{ .host = "smtp.postmarkapp.com", .port = 587, .secure = false } },
    .{ "mandrill", S{ .host = "smtp.mandrillapp.com", .port = 587, .secure = false } },
    .{ "sparkpost", S{ .host = "smtp.sparkpostmail.com", .port = 587, .secure = false } },

    .{ "ethereal", S{ .host = "smtp.ethereal.email", .port = 587, .secure = false } },
    .{ "ethereal.email", S{ .host = "smtp.ethereal.email", .port = 587, .secure = false } },

    .{ "qq", S{ .host = "smtp.qq.com", .port = 465, .secure = true } },
    .{ "qq.com", S{ .host = "smtp.qq.com", .port = 465, .secure = true } },
    .{ "126", S{ .host = "smtp.126.com", .port = 465, .secure = true } },
    .{ "163", S{ .host = "smtp.163.com", .port = 465, .secure = true } },

    .{ "gmx", S{ .host = "mail.gmx.com", .port = 587, .secure = false } },
    .{ "gmx.com", S{ .host = "mail.gmx.com", .port = 587, .secure = false } },
    .{ "gmx.de", S{ .host = "mail.gmx.com", .port = 587, .secure = false } },

    .{ "1und1", S{ .host = "smtp.1und1.de", .port = 465, .secure = true } },

    .{ "yandex", S{ .host = "smtp.yandex.com", .port = 465, .secure = true } },
    .{ "yandex.com", S{ .host = "smtp.yandex.com", .port = 465, .secure = true } },
    .{ "yandex.ru", S{ .host = "smtp.yandex.com", .port = 465, .secure = true } },

    .{ "mail.ru", S{ .host = "smtp.mail.ru", .port = 465, .secure = true } },
    .{ "mailru", S{ .host = "smtp.mail.ru", .port = 465, .secure = true } },

    .{ "gandi", S{ .host = "mail.gandi.net", .port = 587, .secure = false } },
    .{ "gandimail", S{ .host = "mail.gandi.net", .port = 587, .secure = false } },
    .{ "ovh", S{ .host = "ssl0.ovh.net", .port = 465, .secure = true } },
    .{ "mailjet", S{ .host = "in-v3.mailjet.com", .port = 587, .secure = false } },
    .{ "forwardemail", S{ .host = "smtp.forwardemail.net", .port = 465, .secure = true } },
    .{ "elasticemail", S{ .host = "smtp.elasticemail.com", .port = 465, .secure = true } },
    .{ "feishu", S{ .host = "smtp.feishu.cn", .port = 465, .secure = true } },
});

const bun = @import("bun");
