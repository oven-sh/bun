#include "root.h"

#if OS(LINUX) || OS(FREEBSD)

#include "OutPtr.h"
#include "Secrets.h"
#include <dlfcn.h>
#include <wtf/text/WTFString.h>
#include <wtf/NeverDestroyed.h>

namespace Bun {
namespace Secrets {

using namespace WTF;

// Minimal GLib type definitions to avoid linking against GLib
typedef struct _GError GError;
typedef struct _GHashTable GHashTable;
typedef struct _GList GList;
typedef struct _SecretSchema SecretSchema;
typedef struct _SecretService SecretService;
typedef struct _SecretValue SecretValue;
typedef struct _SecretItem SecretItem;

typedef int gboolean;
typedef char gchar;
typedef void* gpointer;
typedef unsigned int guint;
typedef int gint;

// GLib constants
#define G_FALSE 0
#define G_TRUE 1

// Secret schema types
typedef enum {
    SECRET_SCHEMA_NONE = 0,
    SECRET_SCHEMA_DONT_MATCH_NAME = 1 << 1
} SecretSchemaFlags;

typedef enum {
    SECRET_SCHEMA_ATTRIBUTE_STRING = 0,
    SECRET_SCHEMA_ATTRIBUTE_INTEGER = 1,
    SECRET_SCHEMA_ATTRIBUTE_BOOLEAN = 2
} SecretSchemaAttributeType;

typedef struct {
    const gchar* name;
    SecretSchemaAttributeType type;
} SecretSchemaAttribute;

struct _SecretSchema {
    const gchar* name;
    SecretSchemaFlags flags;
    SecretSchemaAttribute attributes[32];

    /* <private> */
    gint reserved;
    gpointer reserved1;
    gpointer reserved2;
    gpointer reserved3;
    gpointer reserved4;
    gpointer reserved5;
    gpointer reserved6;
    gpointer reserved7;
};

struct _GError {
    guint domain;
    int code;
    gchar* message;
};

struct _GList {
    gpointer data;
    GList* next;
    GList* prev;
};

// Secret search flags
typedef enum {
    SECRET_SEARCH_NONE = 0,
    SECRET_SEARCH_ALL = 1 << 1,
    SECRET_SEARCH_UNLOCK = 1 << 2,
    SECRET_SEARCH_LOAD_SECRETS = 1 << 3
} SecretSearchFlags;

using Library = std::unique_ptr<void, decltype([](void* handle) { dlclose(handle); })>;
using GErrorPtr = std::unique_ptr<GError, void (*)(GError*)>;

class LibsecretFramework {
public:
    Library secret_library;
    Library glib_library;
    Library gobject_library;

    // GLib function pointers
    void (*g_error_free)(GError* error);
    void (*g_free)(gpointer mem);
    GHashTable* (*g_hash_table_new)(void* hash_func, void* key_equal_func);
    void (*g_hash_table_destroy)(GHashTable* hash_table);
    gpointer (*g_hash_table_lookup)(GHashTable* hash_table, gpointer key);
    void (*g_hash_table_insert)(GHashTable* hash_table, gpointer key, gpointer value);
    void (*g_list_free)(GList* list);
    void (*g_list_free_full)(GList* list, void (*free_func)(gpointer));
    guint (*g_str_hash)(gpointer v);
    gboolean (*g_str_equal)(gpointer v1, gpointer v2);

    // libsecret function pointers
    gboolean (*secret_password_store_sync)(const SecretSchema* schema,
        const gchar* collection,
        const gchar* label,
        const gchar* password,
        void* cancellable,
        GError** error,
        ...);

    gchar* (*secret_password_lookup_sync)(const SecretSchema* schema,
        void* cancellable,
        GError** error,
        ...);

    gboolean (*secret_password_clear_sync)(const SecretSchema* schema,
        void* cancellable,
        GError** error,
        ...);

    void (*secret_password_free)(gchar* password);

    GList* (*secret_service_search_sync)(SecretService* service,
        const SecretSchema* schema,
        GHashTable* attributes,
        SecretSearchFlags flags,
        void* cancellable,
        GError** error);

    SecretValue* (*secret_item_get_secret)(SecretItem* self);
    const gchar* (*secret_value_get_text)(SecretValue* value);
    void (*secret_value_unref)(gpointer value);
    GHashTable* (*secret_item_get_attributes)(SecretItem* self);
    gboolean (*secret_item_load_secret_sync)(SecretItem* self,
        void* cancellable,
        GError** error);

    bool load()
    {
        // Load GLib
        Library glib { dlopen("libglib-2.0.so.0", RTLD_LAZY | RTLD_GLOBAL) };
        if (!glib) {
            // Try alternative name
            glib.reset(dlopen("libglib-2.0.so", RTLD_LAZY | RTLD_GLOBAL));
            if (!glib) return false;
        }

        // Load GObject (needed for some GLib types)
        Library gobject { dlopen("libgobject-2.0.so.0", RTLD_LAZY | RTLD_GLOBAL) };
        if (!gobject) {
            gobject.reset(dlopen("libgobject-2.0.so", RTLD_LAZY | RTLD_GLOBAL));
            if (!gobject) return false;
        }

        // Load libsecret
        Library secret { dlopen("libsecret-1.so.0", RTLD_LAZY | RTLD_LOCAL) };
        if (!secret || !load_functions(glib.get(), secret.get())) return false;

        secret_library = WTF::move(secret);
        glib_library = WTF::move(glib);
        gobject_library = WTF::move(gobject);
        return true;
    }

private:
    bool load_functions(void* glib_handle, void* secret_handle)
    {
        // Load GLib functions
        g_error_free = (void (*)(GError*))dlsym(glib_handle, "g_error_free");
        g_free = (void (*)(gpointer))dlsym(glib_handle, "g_free");
        g_hash_table_new = (GHashTable * (*)(void*, void*)) dlsym(glib_handle, "g_hash_table_new");
        g_hash_table_destroy = (void (*)(GHashTable*))dlsym(glib_handle, "g_hash_table_destroy");
        g_hash_table_lookup = (gpointer (*)(GHashTable*, gpointer))dlsym(glib_handle, "g_hash_table_lookup");
        g_hash_table_insert = (void (*)(GHashTable*, gpointer, gpointer))dlsym(glib_handle, "g_hash_table_insert");
        g_list_free = (void (*)(GList*))dlsym(glib_handle, "g_list_free");
        g_list_free_full = (void (*)(GList*, void (*)(gpointer)))dlsym(glib_handle, "g_list_free_full");
        g_str_hash = (guint (*)(gpointer))dlsym(glib_handle, "g_str_hash");
        g_str_equal = (gboolean (*)(gpointer, gpointer))dlsym(glib_handle, "g_str_equal");

        // Load libsecret functions
        secret_password_store_sync = (gboolean (*)(const SecretSchema*, const gchar*, const gchar*, const gchar*, void*, GError**, ...))
            dlsym(secret_handle, "secret_password_store_sync");
        secret_password_lookup_sync = (gchar * (*)(const SecretSchema*, void*, GError**, ...))
            dlsym(secret_handle, "secret_password_lookup_sync");
        secret_password_clear_sync = (gboolean (*)(const SecretSchema*, void*, GError**, ...))
            dlsym(secret_handle, "secret_password_clear_sync");
        secret_password_free = (void (*)(gchar*))dlsym(secret_handle, "secret_password_free");
        secret_service_search_sync = (GList * (*)(SecretService*, const SecretSchema*, GHashTable*, SecretSearchFlags, void*, GError**))
            dlsym(secret_handle, "secret_service_search_sync");
        secret_item_get_secret = (SecretValue * (*)(SecretItem*)) dlsym(secret_handle, "secret_item_get_secret");
        secret_value_get_text = (const gchar* (*)(SecretValue*))dlsym(secret_handle, "secret_value_get_text");
        secret_value_unref = (void (*)(gpointer))dlsym(secret_handle, "secret_value_unref");
        secret_item_get_attributes = (GHashTable * (*)(SecretItem*)) dlsym(secret_handle, "secret_item_get_attributes");
        secret_item_load_secret_sync = (gboolean (*)(SecretItem*, void*, GError**))dlsym(secret_handle, "secret_item_load_secret_sync");

        return g_error_free && g_free && g_hash_table_new && g_hash_table_destroy && g_hash_table_lookup && g_hash_table_insert && g_list_free && secret_password_store_sync && secret_password_lookup_sync && secret_password_clear_sync && secret_password_free;
    }
};

static LibsecretFramework* libsecretFramework()
{
    static LazyNeverDestroyed<LibsecretFramework> framework;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        framework.construct();
        if (!framework->load()) {
            // Framework failed to load, but object is still constructed
        }
    });
    return framework->secret_library ? &framework.get() : nullptr;
}

// Define our simple schema for Bun secrets
static const SecretSchema* get_bun_schema()
{
    static const SecretSchema schema = {
        "com.oven-sh.bun.Secret",
        SECRET_SCHEMA_NONE,
        { { "service", SECRET_SCHEMA_ATTRIBUTE_STRING },
            { "account", SECRET_SCHEMA_ATTRIBUTE_STRING },
            { nullptr, (SecretSchemaAttributeType)0 } }
    };
    return &schema;
}

static void updateError(Error& err, const GErrorPtr& gerror)
{
    if (!gerror) {
        err = Error {};
        return;
    }

    err.message = String::fromUTF8(gerror->message);
    err.code = gerror->code;
    err.type = ErrorType::PlatformError;
}

Error setPassword(const UTF8CString& service, const UTF8CString& name, UTF8CString&& password, bool allowUnrestrictedAccess, Persist)
{
    Error err;

    auto* framework = libsecretFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "libsecret not available"_s;
        return err;
    }

    // Empty string means delete - call deletePassword instead
    if (password.length() == 0) {
        deletePassword(service, name, err);
        // Convert delete result to setPassword semantics
        // Delete errors (like NotFound) should not be propagated for empty string sets
        if (err.type == ErrorType::NotFound) {
            err = Error {}; // Clear the error - deleting non-existent is not an error for set("")
        }
        return err;
    }

    GErrorPtr gerror { nullptr, framework->g_error_free };
    // Combine service and name for label
    auto label = makeString(String::fromUTF8(service.span()), "/"_s, String::fromUTF8(name.span()));
    auto labelUtf8 = label.utf8();

    gboolean result = framework->secret_password_store_sync(
        get_bun_schema(),
        nullptr, // Let libsecret handle collection creation automatically
        labelUtf8.legacyCStringPointer(),
        password.legacyCStringPointer(),
        nullptr, // cancellable
        outPtr(gerror),
        "service", service.legacyCStringPointer(),
        "account", name.legacyCStringPointer(),
        nullptr // end of attributes
    );

    if (!result || gerror) {
        updateError(err, gerror);
        if (err.message.isEmpty()) {
            err.type = ErrorType::PlatformError;
            err.message = "Failed to store password"_s;
        }
    }

    return err;
}

std::optional<WTF::Vector<uint8_t>> getPassword(const UTF8CString& service, const UTF8CString& name, Error& err)
{
    err = Error {};

    auto* framework = libsecretFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "libsecret not available"_s;
        return std::nullopt;
    }

    GErrorPtr gerror { nullptr, framework->g_error_free };
    std::unique_ptr<gchar, void (*)(gchar*)> raw_password { nullptr, framework->secret_password_free };

    raw_password.reset(framework->secret_password_lookup_sync(
        get_bun_schema(),
        nullptr, // cancellable
        outPtr(gerror),
        "service", service.legacyCStringPointer(),
        "account", name.legacyCStringPointer(),
        nullptr // end of attributes
        ));

    if (gerror) {
        updateError(err, gerror);
        return std::nullopt;
    }

    if (!raw_password) {
        err.type = ErrorType::NotFound;
        return std::nullopt;
    }

    // Convert to Vector for thread safety
    size_t length = strlen(raw_password.get());
    WTF::Vector<uint8_t> result;
    result.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(raw_password.get()), length));

    // Clear the password before freeing
    memset(raw_password.get(), 0, length);

    return result;
}

bool deletePassword(const UTF8CString& service, const UTF8CString& name, Error& err)
{
    err = Error {};

    auto* framework = libsecretFramework();
    if (!framework) {
        err.type = ErrorType::PlatformError;
        err.message = "libsecret not available"_s;
        return false;
    }

    GErrorPtr gerror { nullptr, framework->g_error_free };

    gboolean result = framework->secret_password_clear_sync(
        get_bun_schema(),
        nullptr, // cancellable
        outPtr(gerror),
        "service", service.legacyCStringPointer(),
        "account", name.legacyCStringPointer(),
        nullptr // end of attributes
    );

    if (gerror) {
        updateError(err, gerror);
        return false;
    }

    // libsecret returns TRUE if items were deleted, FALSE if no items found
    if (!result) {
        err.type = ErrorType::NotFound;
        return false;
    }

    return true;
}

} // namespace Secrets
} // namespace Bun

#endif // OS(LINUX) || OS(FREEBSD)
